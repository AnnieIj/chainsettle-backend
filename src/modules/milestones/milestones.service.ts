// milestones.service.ts
import { 
  Injectable, 
  NotFoundException, 
  Logger, 
  ForbiddenException, 
  ConflictException 
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IpfsService } from '../../common/ipfs/ipfs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MilestoneStatus, NotificationType, DisputeRole, ArbiterStatus } from '@prisma/client';

@Injectable()
export class MilestonesService {
  private readonly logger = new Logger(MilestonesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ipfs: IpfsService,
    private readonly notifications: NotificationsService,
  ) {}

  async findByShipment(shipmentId: string) {
    return this.prisma.milestone.findMany({
      where: { shipmentId },
      orderBy: { milestoneIndex: 'asc' },
    });
  }

  async findOne(shipmentId: string, milestoneIndex: number) {
    const milestone = await this.prisma.milestone.findUnique({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
    });
    if (!milestone) {
      throw new NotFoundException(
        `Milestone ${milestoneIndex} not found on shipment ${shipmentId}`,
      );
    }
    return milestone;
  }

  // ----------------------------------------------------------
  // PROOF SUBMISSION
  // ----------------------------------------------------------

  /**
   * Uploads a proof file to IPFS and persists the resulting CID.
   * Restricted to the shipment's supplierAddress or logisticsAddress.
   *
   * @param shipmentId     - Shipment identifier
   * @param milestoneIndex - 0-based milestone index
   * @param callerAddress  - Stellar address of the authenticated caller
   * @param file           - Uploaded file (from multer)
   * @returns The updated milestone record and the IPFS gateway URL
   */
  async submitProof(
    shipmentId: string,
    milestoneIndex: number,
    callerAddress: string,
    file: Express.Multer.File,
  ) {
    // Fetch the shipment to verify caller is authorized
    const shipment = await this.prisma.shipment.findUnique({
      where: { id: shipmentId },
    });

    if (!shipment) {
      throw new NotFoundException(`Shipment ${shipmentId} not found`);
    }

    const isAuthorized =
      shipment.supplierAddress === callerAddress ||
      shipment.logisticsAddress === callerAddress;

    if (!isAuthorized) {
      throw new ForbiddenException(
        'Only the shipment supplier or logistics provider may submit proof',
      );
    }

    // Ensure the milestone exists before uploading
    const milestone = await this.findOne(shipmentId, milestoneIndex);

    // Upload to IPFS
    const cid = await this.ipfs.uploadFile(
      file.buffer,
      file.originalname,
      file.mimetype,
    );

    // Persist CID + status transition
    const updated = await this.markProofSubmitted(shipmentId, milestoneIndex, cid);

    this.logger.log(
      `Proof submitted for ${shipmentId}[${milestoneIndex}] — CID: ${cid}`,
    );

    // Notify buyer
    await this.notifications.notifyUser(
      shipment.buyerAddress,
      NotificationType.PROOF_SUBMITTED,
      'Proof submitted for review',
      `Milestone ${milestoneIndex} ("${milestone.name}") proof has been uploaded for shipment ${shipmentId}. Please review and confirm.`,
      { shipmentId, milestoneIndex, proofHash: cid },
    );

    return {
      milestone: updated,
      cid,
      gatewayUrl: this.ipfs.getGatewayUrl(cid),
    };
  }

  // ----------------------------------------------------------
  // INTERNAL HELPERS (called by EventsService)
  // ----------------------------------------------------------

  /**
   * Called by EventsService when a proof_submitted event is detected on-chain.
   * Updates the local DB record to reflect the new proof hash and status.
   */
  async markProofSubmitted(
    shipmentId: string,
    milestoneIndex: number,
    proofHash: string,
  ) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: {
        proofHash,
        status: MilestoneStatus.PROOF_SUBMITTED,
      },
    });
  }

  /**
   * Called by EventsService when a milestone_confirmed event is detected.
   */
  async markConfirmed(
    shipmentId: string,
    milestoneIndex: number,
    paymentReleased: bigint,
  ) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: {
        status: MilestoneStatus.CONFIRMED,
        paymentReleased,
        confirmedAt: new Date(),
      },
    });
  }

  /**
   * Called by EventsService when a dispute_raised event is detected.
   */
  async markDisputed(shipmentId: string, milestoneIndex: number) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: { status: MilestoneStatus.DISPUTED },
    });
  }

  /**
   * Called by EventsService when a dispute_resolved event is detected.
   */
  async markResolved(
    shipmentId: string,
    milestoneIndex: number,
    approved: boolean,
    paymentReleased?: bigint,
  ) {
    return this.prisma.milestone.update({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      data: {
        status: approved ? MilestoneStatus.RESOLVED : MilestoneStatus.PENDING,
        ...(approved && paymentReleased
          ? { paymentReleased, confirmedAt: new Date() }
          : {}),
      },
    });
  }

  /**
   * Submit dispute evidence for a milestone
   * Only buyer or supplier can submit when milestone is DISPUTED
   */
  async submitDisputeEvidence(
    shipmentId: string,
    milestoneIndex: number,
    submittedBy: string,
    description: string,
    file?: Express.Multer.File,
  ) {
    // Get milestone and shipment
    const milestone = await this.prisma.milestone.findUnique({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      include: { shipment: true },
    });

    if (!milestone) {
      throw new NotFoundException(
        `Milestone ${milestoneIndex} not found on shipment ${shipmentId}`
      );
    }

    // Check milestone status
    if (milestone.status !== MilestoneStatus.DISPUTED) {
      throw new ConflictException(
        `Cannot submit evidence: milestone status is ${milestone.status}, must be DISPUTED`
      );
    }

    // Determine role and check authorization
    let role: DisputeRole;
    if (submittedBy === milestone.shipment.buyerAddress) {
      role = DisputeRole.BUYER;
    } else if (submittedBy === milestone.shipment.supplierAddress) {
      role = DisputeRole.SUPPLIER;
    } else {
      throw new ForbiddenException(
        'Only the buyer or supplier can submit dispute evidence'
      );
    }

    // Upload file to IPFS if provided
    let ipfsCid: string | null = null;
    let fileName: string | null = null;
    let fileSize: number | null = null;
    let mimeType: string | null = null;

    if (file) {
      try {
        ipfsCid = await this.ipfs.uploadFile(file.buffer, file.originalname, file.mimetype);
        fileName = file.originalname;
        fileSize = file.size;
        mimeType = file.mimetype;
        this.logger.log(
          `Evidence file uploaded to IPFS: ${fileName} -> ${ipfsCid}`
        );
      } catch (error) {
        this.logger.error('Failed to upload evidence to IPFS', error.message);
        throw new Error('Failed to upload file to IPFS');
      }
    }

    // Create evidence record
    const evidence = await this.prisma.disputeEvidence.create({
      data: {
        milestoneId: milestone.id,
        submittedBy,
        role,
        description,
        ipfsCid,
        fileName,
        fileSize,
        mimeType,
      },
    });

    // Only notify the arbiter if they have accepted their assignment
    if (milestone.shipment.arbiterStatus === ArbiterStatus.ACCEPTED) {
      await this.notifications.notifyUser(
        milestone.shipment.arbiterAddress,
        NotificationType.DISPUTE_EVIDENCE_SUBMITTED,
        'New Dispute Evidence Submitted',
        `${role} has submitted evidence for milestone ${milestoneIndex} on shipment ${shipmentId}`,
        {
          shipmentId,
          milestoneIndex,
          evidenceId: evidence.id,
          submittedBy,
          role,
        }
      );
    } else {
      this.logger.warn(
        `Arbiter ${milestone.shipment.arbiterAddress} has not accepted assignment for shipment ${shipmentId} — skipping notification`,
      );
    }

    this.logger.log(
      `Dispute evidence submitted: ${evidence.id} by ${role} for milestone ${milestoneIndex}`
    );

    return evidence;
  }

  /**
   * Get all dispute evidence for a milestone
   * Restricted to shipment participants and admins
   */
  async getDisputeEvidence(
    shipmentId: string,
    milestoneIndex: number,
    requestedBy: string,
  ) {
    // Get milestone and shipment
    const milestone = await this.prisma.milestone.findUnique({
      where: { shipmentId_milestoneIndex: { shipmentId, milestoneIndex } },
      include: { shipment: true },
    });

    if (!milestone) {
      throw new NotFoundException(
        `Milestone ${milestoneIndex} not found on shipment ${shipmentId}`
      );
    }

    // Check authorization - must be a participant
    const isParticipant = [
      milestone.shipment.buyerAddress,
      milestone.shipment.supplierAddress,
      milestone.shipment.logisticsAddress,
      milestone.shipment.arbiterAddress,
    ].includes(requestedBy);

    // Check if user is admin
    const user = await this.prisma.user.findUnique({
      where: { stellarAddress: requestedBy },
    });

    const isAdmin = user?.role === 'ADMIN';

    if (!isParticipant && !isAdmin) {
      throw new ForbiddenException(
        'Only shipment participants can view dispute evidence'
      );
    }

    // Get all evidence for this milestone
    const evidence = await this.prisma.disputeEvidence.findMany({
      where: { milestoneId: milestone.id },
      orderBy: { createdAt: 'asc' },
      include: {
        user: {
          select: {
            stellarAddress: true,
            name: true,
          },
        },
      },
    });

    // Add IPFS gateway URLs
    return evidence.map((item) => ({
      ...item,
      ipfsUrl: item.ipfsCid ? this.ipfs.getGatewayUrl(item.ipfsCid) : null,
    }));
  }
}

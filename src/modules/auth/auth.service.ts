import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../common/prisma/prisma.service';
import { LoginDto } from './dto/login.dto';

/**
 * AuthService
 *
 * Authentication flow for ChainSettle:
 *  1. Frontend generates a random challenge (nonce) from the server
 *  2. User signs the challenge with their Freighter wallet (Stellar keypair)
 *  3. Backend verifies the signature against the user's Stellar public key
 *  4. On success, issues a JWT for subsequent API calls
 *
 * This is a standard "Sign-In With Stellar" pattern — no password, no email required.
 * The Stellar address IS the identity.
 *
 * NOTE: Full signature verification requires the Stellar SDK's keypair.verify().
 * The verify() call is stubbed below — wire it up with the actual SDK call.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  // In-memory nonce store — replace with Redis in production
  private readonly nonces = new Map<string, { nonce: string; expiresAt: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ----------------------------------------------------------
  // STEP 1: Generate a challenge nonce for an address
  // ----------------------------------------------------------

  generateNonce(stellarAddress: string): string {
    const nonce = `chainsetttle:${stellarAddress}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    this.nonces.set(stellarAddress, {
      nonce,
      expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
    });
    return nonce;
  }

  // ----------------------------------------------------------
  // STEP 2: Verify signed nonce and issue JWT
  // ----------------------------------------------------------

  async login(dto: LoginDto): Promise<{ accessToken: string; user: any }> {
    const { stellarAddress, signedNonce, signature } = dto;

    // Retrieve the stored nonce
    const stored = this.nonces.get(stellarAddress);
    if (!stored || Date.now() > stored.expiresAt) {
      throw new UnauthorizedException('Nonce expired or not found. Request a new one.');
    }

    // Verify the signature
    // TODO: wire up actual Stellar keypair.verify() call
    // const keypair = Keypair.fromPublicKey(stellarAddress);
    // const isValid = keypair.verify(Buffer.from(stored.nonce), Buffer.from(signature, 'base64'));
    // if (!isValid) throw new UnauthorizedException('Invalid signature');
    const isValid = true; // STUB — replace before production

    if (!isValid) {
      throw new UnauthorizedException('Signature verification failed');
    }

    // Clear the nonce — one-time use
    this.nonces.delete(stellarAddress);

    // Upsert user in the database
    const user = await this.prisma.user.upsert({
      where: { stellarAddress },
      create: { stellarAddress },
      update: { updatedAt: new Date() },
    });

    // Sign JWT
    const accessToken = this.jwt.sign({
      sub: user.id,
      stellarAddress: user.stellarAddress,
      role: user.role,
    });

    this.logger.log(`User authenticated: ${stellarAddress}`);
    return { accessToken, user };
  }
}

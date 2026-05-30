import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { create, IPFSHTTPClient } from 'ipfs-http-client';

/**
 * IPFS Service for uploading and retrieving files
 * Used for dispute evidence and milestone proof documents
 */
@Injectable()
export class IpfsService {
  private readonly logger = new Logger(IpfsService.name);
  private client: IPFSHTTPClient;

  constructor(private readonly config: ConfigService) {
    const ipfsUrl = this.config.get<string>('IPFS_API_URL', 'http://localhost:5001');
    
    try {
      this.client = create({ url: ipfsUrl });
      this.logger.log(`IPFS client connected to ${ipfsUrl}`);
    } catch (error) {
      this.logger.error('Failed to initialize IPFS client', error.message);
    }
  }

  /**
   * Upload a file to IPFS
   * @param buffer File buffer
   * @param filename Original filename
   * @returns IPFS CID (Content Identifier)
   */
  async uploadFile(buffer: Buffer, filename: string): Promise<string> {
    try {
      const result = await this.client.add(
        {
          path: filename,
          content: buffer,
        },
        {
          pin: true, // Pin the file to prevent garbage collection
        }
      );

      this.logger.log(`File uploaded to IPFS: ${filename} -> ${result.cid.toString()}`);
      return result.cid.toString();
    } catch (error) {
      this.logger.error(`Failed to upload file to IPFS: ${filename}`, error.message);
      throw new Error(`IPFS upload failed: ${error.message}`);
    }
  }

  /**
   * Get IPFS gateway URL for a CID
   * @param cid IPFS Content Identifier
   * @returns Public gateway URL
   */
  getGatewayUrl(cid: string): string {
    const gateway = this.config.get<string>('IPFS_GATEWAY_URL', 'https://ipfs.io/ipfs');
    return `${gateway}/${cid}`;
  }

  /**
   * Retrieve file content from IPFS
   * @param cid IPFS Content Identifier
   * @returns File buffer
   */
  async getFile(cid: string): Promise<Buffer> {
    try {
      const chunks: Uint8Array[] = [];
      
      for await (const chunk of this.client.cat(cid)) {
        chunks.push(chunk);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error(`Failed to retrieve file from IPFS: ${cid}`, error.message);
      throw new Error(`IPFS retrieval failed: ${error.message}`);
    }
  }

  /**
   * Check if IPFS client is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.client.id();
      return true;
    } catch (error) {
      this.logger.warn('IPFS client not available', error.message);
      return false;
    }
  }
}

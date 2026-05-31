import { Injectable, UnauthorizedException, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Keypair } from '@stellar/stellar-sdk';
import { PrismaService } from '../../common/prisma/prisma.service';
import { RedisService } from '../../common/redis/redis.service';
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
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly NONCE_PREFIX = 'chainsettle:nonce:';
  private readonly NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes in milliseconds


  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly redis: RedisService,
  ) { }

  // ----------------------------------------------------------
  // STEP 1: Generate a challenge nonce for an address
  // ----------------------------------------------------------

  async generateNonce(stellarAddress: string): Promise<string> {
    const nonce = `chainsettle:${stellarAddress}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const key = `${this.NONCE_PREFIX}${stellarAddress}`;

    // Store in Redis with 5-minute expiration using Redis-native TTL
    await this.redis.setPx(key, nonce, this.NONCE_TTL_MS);


    return nonce;
  }

  // ----------------------------------------------------------
  // STEP 2: Verify signed nonce and issue JWT
  // ----------------------------------------------------------

  async login(dto: LoginDto): Promise<{ accessToken: string; user: any }> {
    const { stellarAddress, signedNonce, signature } = dto;

    // Retrieve the stored nonce from Redis
    const key = `${this.NONCE_PREFIX}${stellarAddress}`;
    const storedNonce = await this.redis.get(key);


    if (!storedNonce) {
      throw new UnauthorizedException('Nonce expired or not found. Request a new one.');
    }

    // Verify the signature against the stored nonce.
    let isValid = false;
    try {
      const keypair = Keypair.fromPublicKey(stellarAddress);
      const signatureBuffer = Buffer.from(signature, 'base64');
      isValid = keypair.verify(Buffer.from(storedNonce), signatureBuffer);
    } catch (err) {
      this.logger.warn(`Signature verification failed for ${stellarAddress}`);
      throw new UnauthorizedException('Signature verification failed');
    }

    if (!isValid) {
      throw new UnauthorizedException('Signature verification failed');
    }

    // Clear the nonce — one-time use
    await this.redis.del(key);

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

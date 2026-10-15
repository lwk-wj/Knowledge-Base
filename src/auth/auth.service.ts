import {
  Injectable,
  UnauthorizedException,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthUser } from './auth-user.interface';
import { LoginDto, RegisterDto, SendRegisterCodeDto } from './dto/auth.dto';
import { ResetPasswordByEmailDto, SendResetCodeDto } from '../user/dto/extra.dto';
import { UserService } from '../user/user.service';
import { EmailService } from './email.service';
import { EmailActivationService } from './email-activation.service';
import {
  RegisterCodeService,
  REGISTER_CODE_COOLDOWN_SECONDS,
  REGISTER_CODE_TTL_SECONDS,
} from './register-code.service';
import {
  PasswordResetService,
  RESET_CODE_COOLDOWN_SECONDS,
  RESET_CODE_TTL_SECONDS,
} from './password-reset.service';

export interface LoginResult {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
  expiresIn: number;
  userInfo: AuthUser;
}

interface TokenPayload {
  sub: string;
  username: string;
  type: 'access' | 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly emailService: EmailService,
    private readonly emailActivation: EmailActivationService,
    private readonly registerCode: RegisterCodeService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  private accessExpires(): string {
    return this.config.get<string>('JWT_ACCESS_EXPIRES', '2h');
  }

  private refreshExpires(): string {
    return this.config.get<string>('JWT_REFRESH_EXPIRES', '7d');
  }

  private accessExpiresSeconds(): number {
    const raw = this.accessExpires();
    const match = /^(\d+)([smhd])$/.exec(raw);
    if (!match) return 7200;
    const n = Number(match[1]);
    const unit = match[2];
    if (unit === 's') return n;
    if (unit === 'm') return n * 60;
    if (unit === 'h') return n * 3600;
    return n * 86400;
  }

  private signAccessToken(user: AuthUser): string {
    const payload: TokenPayload = {
      sub: user.userId,
      username: user.username,
      type: 'access',
    };
    return this.jwtService.sign(payload, {
      expiresIn: this.accessExpires() as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
  }

  private signRefreshToken(user: AuthUser): string {
    const payload: TokenPayload = {
      sub: user.userId,
      username: user.username,
      type: 'refresh',
    };
    return this.jwtService.sign(payload, {
      expiresIn: this.refreshExpires() as `${number}${'s' | 'm' | 'h' | 'd'}`,
    });
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.userService.validateCredentials(
      dto.username,
      dto.password,
    );
    await this.userService.touchLastLogin(user.userId);
    return this.buildLoginResult(user);
  }

  /** 发送注册邮箱验证码（10分钟有效，60秒冷却防刷） */
  async sendRegisterCode(dto: SendRegisterCodeDto): Promise<{ message: string }> {
    const exists = await this.userService.findByEmail(dto.email);
    if (exists) {
      throw new ConflictException('该邮箱已被注册');
    }

    // 检查冷却时间：剩余 TTL 大于 (总TTL - 冷却时间) 说明刚发过不久
    const ttl = await this.registerCode.getTtl(dto.email);
    if (ttl > REGISTER_CODE_TTL_SECONDS - REGISTER_CODE_COOLDOWN_SECONDS) {
      throw new BadRequestException('验证码发送过于频繁，请稍后再试');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.registerCode.set(dto.email, code);
    try {
      await this.emailService.sendRegisterCodeEmail(dto.email, code);
    } catch {
      await this.registerCode.delete(dto.email);
      throw new BadRequestException('验证码邮件发送失败，请稍后再试');
    }

    return { message: '验证码已发送至您的邮箱，10 分钟内有效' };
  }

  /** 注册：验证码校验通过后才入库，直接激活状态 */
  async register(
    dto: RegisterDto,
  ): Promise<{ userId: string; message: string }> {
    const isValid = await this.registerCode.verify(dto.email, dto.code);
    if (!isValid) {
      throw new BadRequestException('验证码错误或已过期');
    }

    const result = await this.userService.register({
      username: dto.username,
      password: dto.password,
      email: dto.email,
      realName: dto.realName,
      requireEmailVerification: false,
    });

    // 注册成功，移除已消费的验证码
    await this.registerCode.delete(dto.email);

    return {
      userId: result.userId,
      message: '注册成功，请登录',
    };
  }

  async verifyEmail(token: string): Promise<{ message: string }> {
    const userId = await this.emailActivation.consumeToken(token);
    if (!userId) {
      throw new BadRequestException('激活链接无效或已过期');
    }
    const message = await this.userService.activateEmail(userId);
    return { message };
  }

  async sendResetCode(dto: SendResetCodeDto): Promise<{ message: string }> {
    const user = await this.userService.findByEmail(dto.email);
    if (!user) {
      throw new NotFoundException('该邮箱未注册');
    }

    // Redis 剩余 TTL：刚发出去时约 600s。剩余 > 540s 说明距上次发送不足 60s，拦截重复发送
    const ttl = await this.passwordReset.getTtl(dto.email);
    if (ttl > RESET_CODE_TTL_SECONDS - RESET_CODE_COOLDOWN_SECONDS) {
      throw new BadRequestException('验证码已发送，请稍后再试');
    }

    const code = String(Math.floor(100000 + Math.random() * 900000));
    await this.passwordReset.set(dto.email, code);
    try {
      await this.emailService.sendResetCodeEmail(dto.email, user.username, code);
    } catch {
      await this.passwordReset.delete(dto.email);
      throw new BadRequestException('邮件发送失败，请稍后再试');
    }
    return { message: '验证码已发送' };
  }

  async resetPasswordByEmail(
    dto: ResetPasswordByEmailDto,
  ): Promise<{ message: string }> {
    if (!(await this.passwordReset.verify(dto.email, dto.code))) {
      throw new BadRequestException('验证码错误或已过期');
    }
    await this.userService.resetPasswordByEmail(dto.email, dto.newPassword);
    await this.passwordReset.delete(dto.email);
    return { message: '密码重置成功，请登录' };
  }

  async refresh(refreshToken: string): Promise<LoginResult> {
    let payload: TokenPayload;
    try {
      payload = this.jwtService.verify<TokenPayload>(refreshToken);
    } catch {
      throw new UnauthorizedException('refresh token 无效或已过期');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('无效的 refresh token');
    }
    const user = await this.userService.buildAuthUser(payload.sub);
    return this.buildLoginResult(user);
  }

  async getMe(userId: string): Promise<AuthUser> {
    return this.userService.buildAuthUser(userId);
  }

  async buildAuthUser(userId: string): Promise<AuthUser> {
    return this.userService.buildAuthUser(userId);
  }

  async getReviewerIds(): Promise<string[]> {
    return this.userService.getUserIdsByRoleCode('ROLE_REVIEWER');
  }

  private buildLoginResult(user: AuthUser): LoginResult {
    return {
      accessToken: this.signAccessToken(user),
      refreshToken: this.signRefreshToken(user),
      tokenType: 'Bearer',
      expiresIn: this.accessExpiresSeconds(),
      userInfo: user,
    };
  }
}

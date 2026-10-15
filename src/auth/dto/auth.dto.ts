import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

/** 登录 */
export class LoginDto {
  @IsString()
  username: string;

  @IsString()
  password: string;
}

/** 发送注册验证码 */
export class SendRegisterCodeDto {
  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;
}

/** 注册（国内主流：邮箱 + 验证码校验通过才入库） */
export class RegisterDto {
  @IsString()
  username: string;

  @IsString()
  @MinLength(6, { message: '密码长度至少为 6 位' })
  password: string;

  @IsEmail({}, { message: '邮箱格式不正确' })
  email: string;

  @IsString({ message: '验证码不能为空' })
  code: string;

  @IsOptional()
  @IsString()
  realName?: string;
}

/** 刷新 Token */
export class RefreshTokenDto {
  @IsString()
  refreshToken: string;
}

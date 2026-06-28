import { IsString, IsOptional, ValidateNested, IsArray, ArrayMinSize } from 'class-validator';
import { Type } from 'class-transformer';

class StatusMediaInput {
  @IsOptional()
  @IsString()
  url?: string;

  @IsOptional()
  @IsString()
  base64?: string;

  @IsOptional()
  @IsString()
  mimetype?: string;
}

export class SendImageStatusDto {
  @ValidateNested()
  @Type(() => StatusMediaInput)
  image: StatusMediaInput;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  recipients: string[];
}

export class SendVideoStatusDto {
  @ValidateNested()
  @Type(() => StatusMediaInput)
  video: StatusMediaInput;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  recipients: string[];
}

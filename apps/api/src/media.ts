import {
  Injectable,
  Controller,
  Post,
  Delete,
  UseInterceptors,
  UploadedFile,
  Req,
  Param,
  UseGuards,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import sharp from "sharp";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Db, AuthGuard, AuthRequest, adult, fail, parse, rate } from "./core";
import { s3 } from "./notifications";
@Injectable()
export class MediaService {
  constructor(private db: Db) {}
  async upload(id: string, file: { buffer: Buffer; size: number } | undefined) {
    await adult(this.db, id);
    await rate(this.db, `media:${id}`, 20, 3600);
    if (!process.env.S3_BUCKET || !process.env.S3_PUBLIC_URL)
      fail(503, "MEDIA_UNAVAILABLE", "Image storage is not configured");
    if (!file?.buffer || file.size > 8 * 1024 * 1024)
      fail(422, "PHOTO_INVALID", "Upload an image up to 8 MB");
    let buffer: Buffer;
    try {
      const meta = await sharp(file.buffer, {
        limitInputPixels: 25000000,
      }).metadata();
      if (!["jpeg", "png", "webp"].includes(meta.format || ""))
        fail(422, "PHOTO_INVALID", "Use JPEG, PNG or WebP");
      buffer = await sharp(file.buffer, {
        limitInputPixels: 25000000,
        animated: false,
      })
        .rotate()
        .resize(1400, 1400, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: 85 })
        .toBuffer();
    } catch {
      fail(422, "PHOTO_INVALID", "Invalid image");
    }
    const key = `users/${id}/${randomUUID()}.webp`;
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: "image/webp",
      }),
    );
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${id}::uuid FOR UPDATE`;
        const count = await tx.userPhoto.count({ where: { userId: id } });
        if (count >= 6) fail(409, "PHOTO_LIMIT", "Maximum 6 photos");
        return tx.userPhoto.create({
          data: {
            userId: id,
            url: `${process.env.S3_PUBLIC_URL!.replace(/\/$/, "")}/${key}`,
            storageKey: key,
            sortOrder: count,
          },
        });
      });
    } catch (e) {
      await s3()
        .send(
          new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }),
        )
        .catch(() => {});
      throw e;
    }
  }
  async remove(userId: string, id: string, admin = false) {
    parse(z.string().uuid(), id);
    const p = await this.db.userPhoto.findUnique({ where: { id } });
    if (!p || (!admin && p.userId !== userId))
      fail(404, "NOT_FOUND", "Photo unavailable");
    await this.db.$transaction(async (tx) => {
      await tx.userPhoto.delete({ where: { id } });
      await tx.outbox.upsert({
        where: { dedupeKey: `delete:${p.storageKey}` },
        create: {
          kind: "DELETE_MEDIA",
          payload: { key: p.storageKey },
          dedupeKey: `delete:${p.storageKey}`,
        },
        update: {},
      });
    });
    return { deleted: true };
  }
}
@Controller("users/me/photos")
@UseGuards(AuthGuard)
export class MediaController {
  constructor(private media: MediaService) {}
  @Post()
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  upload(@Req() r: AuthRequest, @UploadedFile() file: any) {
    return this.media.upload(r.user.id, file);
  }
  @Delete(":id") remove(@Req() r: AuthRequest, @Param("id") id: string) {
    return this.media.remove(r.user.id, id);
  }
}

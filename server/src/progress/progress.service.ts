import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { ProgressData, ProgressResponse } from './progress.dto';

@Injectable()
export class ProgressService {
  constructor(private readonly prisma: PrismaService) {}

  async get(userId: string): Promise<ProgressResponse> {
    const row = await this.prisma.progress.findUnique({ where: { userId } });
    if (!row) return { exists: false, data: null, updatedAt: null };

    return {
      exists: true,
      data: row.data as ProgressData,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async save(userId: string, data: ProgressData): Promise<ProgressResponse> {
    const payload = data as Prisma.InputJsonValue;
    const row = await this.prisma.progress.upsert({
      where: { userId },
      create: { userId, data: payload },
      update: { data: payload },
    });

    return {
      exists: true,
      data: row.data as ProgressData,
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}

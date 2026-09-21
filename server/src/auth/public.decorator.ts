import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'banana:isPublic';

/** Marks a route as reachable without a session (only the login endpoint). */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC_KEY, true);

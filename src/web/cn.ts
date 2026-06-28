/**
 * @module web/cn
 * Class-name joiner with Tailwind conflict resolution (clsx + tailwind-merge).
 * @since 1.0.0
 */
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Join class values, resolving conflicting Tailwind utilities (last wins). @since 1.0.0 */
export const cn = (...inputs: ReadonlyArray<ClassValue>): string => twMerge(clsx(inputs));

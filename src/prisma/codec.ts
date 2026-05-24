/**
 * Prisma compatibility exports for the shared ProcessStore event codec.
 *
 * @module ProcessStore/Prisma/Codec
 */

export {
  decodeEventRow,
  encodeEvent,
  ProcessStoreEventDecodeError as PrismaProcessStoreDecodeError,
} from "../internal/store/codec";

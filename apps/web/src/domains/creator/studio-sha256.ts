/**
 * Frontend compatibility entrypoint. The dependency-free implementation lives in `lib` so
 * browser and API/shared contracts can use identical SHA-256 vectors without a lib -> UI import.
 */
export {
  createSha256Portable,
  sha256HexPortable,
  type StudioPortableSha256,
} from "../../shared/lib/sha256-portable";

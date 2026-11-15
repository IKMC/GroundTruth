import { secp256k1 } from "@noble/curves/secp256k1"
import { keccak_256 } from "@noble/hashes/sha3"
import { bytesToHex, hexToBytes, stringToBytes, type Hex } from "viem"

/**
 * Synchronous EIP-191 (personal_sign) signer recovery.
 * viem exposes this only as async; CRE node-mode functions are simpler when synchronous.
 */
export function recoverSigner(message: string, signature: Hex): Hex | null {
  try {
    const sig = hexToBytes(signature)
    if (sig.length !== 65) return null
    let v = sig[64]
    if (v >= 27) v -= 27
    if (v !== 0 && v !== 1) return null

    const body = stringToBytes(message)
    const prefix = stringToBytes(`\x19Ethereum Signed Message:\n${body.length}`)
    const data = new Uint8Array(prefix.length + body.length)
    data.set(prefix, 0)
    data.set(body, prefix.length)
    const digest = keccak_256(data)

    const parsed = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v)
    const pub = parsed.recoverPublicKey(digest).toRawBytes(false) // 65 bytes, 0x04 prefix
    const addr = keccak_256(pub.slice(1)).slice(12)
    return bytesToHex(addr)
  } catch {
    return null
  }
}

import { concatHex, encodeAbiParameters, keccak256, type Hex } from "viem"

/** Leaf format matches FieldOracle.claim: keccak256(bytes.concat(keccak256(abi.encode(addr, amount)))). */
export function leafHash(address: Hex, amount: bigint): Hex {
  const inner = keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [address, amount]))
  return keccak256(inner)
}

/** Commutative pair hash, identical to OpenZeppelin MerkleProof: smaller value first. */
export function pairHash(a: Hex, b: Hex): Hex {
  return BigInt(a) <= BigInt(b) ? keccak256(concatHex([a, b])) : keccak256(concatHex([b, a]))
}

export type MerkleTree = { root: Hex; layers: Hex[][] }

/** Sorted leaves; an odd node at the end of a level is promoted unchanged. */
export function buildTree(leaves: Hex[]): MerkleTree {
  if (leaves.length === 0) return { root: `0x${"00".repeat(32)}`, layers: [[]] }
  const sorted = [...leaves].sort((x, y) => (BigInt(x) < BigInt(y) ? -1 : BigInt(x) > BigInt(y) ? 1 : 0))
  const layers: Hex[][] = [sorted]
  while (layers[layers.length - 1].length > 1) {
    const cur = layers[layers.length - 1]
    const next: Hex[] = []
    for (let i = 0; i < cur.length; i += 2) next.push(i + 1 < cur.length ? pairHash(cur[i], cur[i + 1]) : cur[i])
    layers.push(next)
  }
  return { root: layers[layers.length - 1][0], layers }
}

export function proofFor(tree: MerkleTree, leaf: Hex): Hex[] {
  let idx = tree.layers[0].indexOf(leaf)
  if (idx < 0) throw new Error("leaf not in tree")
  const proof: Hex[] = []
  for (let level = 0; level < tree.layers.length - 1; level++) {
    const sibling = tree.layers[level][idx ^ 1]
    if (sibling !== undefined) proof.push(sibling)
    idx = Math.floor(idx / 2)
  }
  return proof
}

export function verifyProof(proof: Hex[], root: Hex, leaf: Hex): boolean {
  return proof.reduce((acc, p) => pairHash(acc, p), leaf) === root
}

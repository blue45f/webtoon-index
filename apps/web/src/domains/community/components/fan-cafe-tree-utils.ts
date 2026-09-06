import type { FanCafeReply } from "@/shared/lib/types";

// 소프트 삭제 마스킹(서버 maskDeletedReply와 동일 형태) — 하위 답글 자리 보존.
export function maskReplyNode(tree: FanCafeReply[], replyId: string): FanCafeReply[] {
  return tree.map((item) => {
    if (item.id === replyId) {
      return { ...item, deleted: true, text: "", author: { name: "삭제됨", avatar: "#5b5751" } };
    }
    if (!item.children || item.children.length === 0) return item;
    return { ...item, children: maskReplyNode(item.children, replyId) };
  });
}

export function removeReplyNode(tree: FanCafeReply[], replyId: string): FanCafeReply[] {
  return tree
    .filter((item) => item.id !== replyId)
    .map((item) =>
      item.children && item.children.length > 0 ? { ...item, children: removeReplyNode(item.children, replyId) } : item
    );
}

export function countReplies(items: FanCafeReply[]): number {
  return items.reduce((count, item) => count + 1 + countReplies(item.children ?? []), 0);
}

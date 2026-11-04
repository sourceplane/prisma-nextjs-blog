import type { NextApiResponse } from "next";
import type { Session } from "next-auth";
import prisma from "./prisma";

// Not upstream's check. Upstream's publish and delete routes acted on ANY post
// for ANY signed-in visitor: the post page only hides the buttons from
// everyone but the author, and the routes trusted that. On a public site any
// GitHub account could publish or delete anyone's post with one request. So
// both routes first ask: does the post exist (404 if not), and is the signed-in
// visitor its author (403 if not)? Then they do exactly what upstream did.
export async function ownPost(id: string, session: Session, res: NextApiResponse): Promise<boolean> {
  const post = await prisma.post.findUnique({
    where: { id },
    select: { author: { select: { email: true } } },
  });
  if (!post) {
    res.status(404).send({ message: "Not found" });
    return false;
  }
  if (!session.user?.email || post.author?.email !== session.user.email) {
    res.status(403).send({ message: "Forbidden" });
    return false;
  }
  return true;
}

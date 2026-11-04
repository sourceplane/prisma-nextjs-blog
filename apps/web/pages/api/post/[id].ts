import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import prisma from '../../../lib/prisma'
import { authOptions } from '../../../lib/auth'
import { ownPost } from '../../../lib/own-post'


// DELETE /api/post/:id
export default async function handle(req: NextApiRequest, res: NextApiResponse) {
  const postId = req.query.id;

  const session = await getServerSession(req, res, await authOptions())

  if (req.method === "DELETE") {
    if (session) {
      if (!(await ownPost(String(postId), session, res))) return;
      const post = await prisma.post.delete({
        where: { id: String(postId) },
      });
      res.json(post);
    } else {
      res.status(401).send({ message: 'Unauthorized' })
    }
  } else {
    throw new Error(
      `The HTTP ${req.method} method is not supported at this route.`
    );
  }
}

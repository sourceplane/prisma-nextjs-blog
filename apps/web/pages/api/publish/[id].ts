import type { NextApiRequest, NextApiResponse } from 'next'
import { getServerSession } from 'next-auth/next'
import prisma from '../../../lib/prisma'
import { authOptions } from '../../../lib/auth'
import { ownPost } from '../../../lib/own-post'

// PUT /api/publish/:id
export default async function handle(req: NextApiRequest, res: NextApiResponse) {
  const postId = req.query.id;
  const session = await getServerSession(req, res, await authOptions())

  if (session) {
    if (!(await ownPost(String(postId), session, res))) return;
    const post = await prisma.post.update({
      where: { id: String(postId) },
      data: { published: true },
    });
    res.json(post);
  } else {
    res.status(401).send({ message: 'Unauthorized' })
  }
}

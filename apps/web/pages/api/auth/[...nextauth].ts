import type { NextApiHandler } from "next";
import NextAuth from "next-auth";
import { authOptions } from "../../../lib/auth";

const authHandler: NextApiHandler = async (req, res) => NextAuth(req, res, await authOptions());
export default authHandler;

import React from "react";
import Layout from "../../components/Layout";

// Not upstream's page. The header's "Log in" opens next-auth's sign-in page,
// which lists the providers it has — GitHub, once its OAuth App is connected
// (lib/github.ts). Until then there is no provider, so lib/auth.ts points
// next-auth's sign-in page here instead of a page with no button on it.
const NotConnected: React.FC = () => (
  <Layout>
    <div className="page">
      <h1>Sign-in is not connected yet</h1>
      <p>
        This blog signs its writers in with GitHub. Its owner has not connected a GitHub OAuth App yet: create one
        whose callback URL is this site&apos;s <code>/api/auth/callback/github</code>, then set its client id and
        secret as <code>GITHUB_ID</code> and <code>GITHUB_SECRET</code> and redeploy.
      </p>
      <p>The feed and every published post can be read without signing in.</p>
    </div>
    <style jsx>{`
      .page {
        background: white;
        padding: 2rem;
      }
    `}</style>
  </Layout>
);

export default NotConnected;

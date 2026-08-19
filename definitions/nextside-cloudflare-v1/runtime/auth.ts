import { magicLink } from 'better-auth/plugins';

export type AuthMagicLinkDelivery = {
  email: string;
  token: string;
  url: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

type CreateTemplateAuthOptionsInput = {
  baseURL: string;
  secret: string;
  sendMagicLink(input: AuthMagicLinkDelivery): Promise<void>;
  sendVerificationEmail(input: {
    user: { id: string; email: string; name: string; emailVerified: boolean };
    token: string;
    url: string;
  }): Promise<void>;
  onUserCreated(user: { id: string; email: string }): Promise<void>;
  onUserEmailVerified(user: { id: string; email: string }): Promise<void>;
};

export const createTemplateAuthOptions = ({
  baseURL,
  secret,
  sendMagicLink,
  sendVerificationEmail,
  onUserCreated,
  onUserEmailVerified,
}: CreateTemplateAuthOptionsInput) => ({
  baseURL,
  secret,
  trustedOrigins: [baseURL],
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 12,
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,
    requireEmailVerification: true,
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async ({
      user,
      token,
      url,
    }: {
      user: { id: string; email: string; name: string; emailVerified: boolean };
      token: string;
      url: string;
    }) => {
      await sendVerificationEmail({ user, token, url });
    },
    afterEmailVerification: async (user: { id: string; email: string }) => {
      await onUserEmailVerified(user);
    },
  },
  databaseHooks: {
    user: {
      create: {
        after: async (user: { id: string; email: string }) => {
          await onUserCreated(user);
        },
      },
    },
  },
  plugins: [
    magicLink({
      sendMagicLink: async ({ email, token, url, metadata }) => {
        await sendMagicLink({
          email,
          token,
          url,
          createdAt: new Date().toISOString(),
          metadata,
        });
      },
    }),
  ],
});

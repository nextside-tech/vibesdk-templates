import { betterAuth } from 'better-auth';
import { magicLink } from 'better-auth/plugins';

export const auth = betterAuth({
  baseURL: 'http://localhost:3000',
  secret: 'schema-generation-only-secret-for-nextside-auth',
  database: {
    type: 'sqlite',
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    maxPasswordLength: 128,
    autoSignIn: false,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    sendVerificationEmail: async () => {},
  },
  plugins: [
    magicLink({
      sendMagicLink: async () => {},
    }),
  ],
});

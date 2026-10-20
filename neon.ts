import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Scheduled expiry runs independently of the Vercel frontend.
  functions: {
    roomcleanup: {name: 'Expire inactive game rooms',source: './functions/roomcleanup.ts'},
  },
  triggers: {
    'expired-rooms': {type: 'schedule',function: 'roomcleanup',cron: '*/15 * * * *'},
  },
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});

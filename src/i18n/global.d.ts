import type messages from "../../messages/en.json";

// Type-check translation keys at compile time.
declare module "next-intl" {
  interface AppConfig {
    Messages: typeof messages;
  }
}

import { LandingContent } from "@/components/LandingContent";
import { LocaleRedirect } from "@/components/LocaleRedirect";
import { en } from "@/lib/i18n/en";

export default function EnglishLandingPage() {
  return (
    <>
      <LocaleRedirect />
      <LandingContent dict={en} locale="en" />
    </>
  );
}

"use client";

import Link from "next/link";
import { usePostHog } from "posthog-js/react";
import { cn } from "@/utils";
import { Logo } from "@/components/new-landing/common/Logo";
import { Button } from "@/components/new-landing/common/Button";
import { HeaderLinks } from "@/components/new-landing/HeaderLinks";
import { landingPageAnalytics } from "@/hooks/useAnalytics";

// Solutions and Pricing are hidden until those pages are ready, not removed.
const SHOW_NAV_LINKS = false;

interface HeaderProps {
  className: string;
}

export function Header({ className }: HeaderProps) {
  const posthog = usePostHog();

  return (
    <header
      className={cn(
        "bg-white mx-auto flex items-center justify-between h-16",
        className,
      )}
    >
      <div className="hidden md:block">
        <Logo />
      </div>
      <div className="block md:hidden">
        <Logo variant="mobile" />
      </div>
      {SHOW_NAV_LINKS ? <HeaderLinks /> : null}
      <div className="flex items-center gap-3">
        <div className="hidden md:block">
          <Button variant="secondary" asChild>
            <Link
              href="/login"
              onClick={() => landingPageAnalytics.logInClicked(posthog)}
            >
              Log in
            </Link>
          </Button>
        </div>
        <Button asChild>
          <Link
            href="/login"
            onClick={() => landingPageAnalytics.getStartedClicked(posthog)}
          >
            <span className="relative z-10">Get Started</span>
          </Link>
        </Button>
      </div>
    </header>
  );
}

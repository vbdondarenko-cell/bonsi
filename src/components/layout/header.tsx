"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { motion, useScroll, useSpring } from "motion/react";
import { buttonStyles } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { nav, site } from "@/lib/site";

export function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);

  const { scrollYProgress } = useScroll();
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 30, restDelta: 0.001 });

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        toggleRef.current?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (menuRef.current?.contains(target) || toggleRef.current?.contains(target)) return;
      setOpen(false);
    };
    const desktop = window.matchMedia("(min-width: 768px)");
    const onBreakpointChange = (event: MediaQueryListEvent) => {
      if (event.matches) setOpen(false);
    };
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const body = document.body;
    const root = document.documentElement;
    const header = headerRef.current;
    const previousHeaderStyles = header
      ? { position: header.style.position, top: header.style.top, left: header.style.left, right: header.style.right, width: header.style.width }
      : null;
    const previousBodyStyles = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
    };
    const previousDocumentOverflow = root.style.overflow;
    const previousScrollBehavior = root.style.scrollBehavior;
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = `-${scrollX}px`;
    body.style.right = "0";
    body.style.width = "100%";
    if (header) {
      header.style.position = "fixed";
      header.style.top = "0";
      header.style.left = "0";
      header.style.right = "0";
      header.style.width = "100%";
    }
    document.body.style.overflow = "hidden";
    root.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    desktop.addEventListener("change", onBreakpointChange);
    if (desktop.matches) setOpen(false);
    return () => {
      body.style.position = previousBodyStyles.position;
      body.style.top = previousBodyStyles.top;
      body.style.left = previousBodyStyles.left;
      body.style.right = previousBodyStyles.right;
      body.style.width = previousBodyStyles.width;
      body.style.overflow = previousBodyStyles.overflow;
      if (header && previousHeaderStyles) {
        header.style.position = previousHeaderStyles.position;
        header.style.top = previousHeaderStyles.top;
        header.style.left = previousHeaderStyles.left;
        header.style.right = previousHeaderStyles.right;
        header.style.width = previousHeaderStyles.width;
      }
      root.style.overflow = previousDocumentOverflow;
      root.style.scrollBehavior = "auto";
      window.scrollTo(scrollX, scrollY);
      root.style.scrollBehavior = previousScrollBehavior;
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
      desktop.removeEventListener("change", onBreakpointChange);
    };
  }, [open]);

  const orderHref = pathname === "/" ? "#order" : "/contact";

  return (
    <header ref={headerRef} className="sticky top-0 z-50 border-b border-line/70 bg-bg/85 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
      <motion.div
        aria-hidden="true"
        style={{ scaleX: progress }}
        className="absolute inset-x-0 top-0 h-px origin-left bg-accent-soft"
      />
      <div className="mx-auto flex h-16 w-full max-w-[1200px] items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          aria-label={`${site.name} — на головну`}
          className="font-mono text-lg font-semibold tracking-[0.2em]"
        >
          BONSI<span className="text-accent-soft">.</span>
        </Link>

        <nav aria-label="Основна навігація" className="hidden items-center gap-1 md:flex">
          {nav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-2 text-sm transition-colors",
                  active ? "bg-surface-2 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/login"
            aria-current={pathname === "/login" ? "page" : undefined}
            className="ml-2 rounded-full border border-line px-4 py-2 text-sm text-muted transition-colors hover:border-accent-soft hover:text-fg"
          >
            Кабінет
          </Link>
          <Link href={orderHref} className={buttonStyles("primary", "ml-2 min-h-10 px-5 text-sm")}>
            Обговорити проєкт
          </Link>
        </nav>

        <button
          ref={toggleRef}
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Закрити меню" : "Відкрити меню"}
          className="flex size-11 items-center justify-center rounded-full border border-line md:hidden"
        >
          <span aria-hidden="true" className="relative block h-3 w-5">
            <span
              className={cn(
                "absolute left-0 h-px w-5 bg-fg transition-all duration-200",
                open ? "top-1.5 rotate-45" : "top-0",
                "motion-reduce:transition-none",
              )}
            />
            <span
              className={cn(
                "absolute left-0 h-px w-5 bg-fg transition-all duration-200",
                open ? "top-1.5 -rotate-45" : "top-3",
                "motion-reduce:transition-none",
              )}
            />
          </span>
        </button>
      </div>

      {open ? (
        <div
          ref={menuRef}
          id="mobile-menu"
          className="fixed inset-x-0 bottom-0 top-[calc(4rem+env(safe-area-inset-top,0px)+1px)] z-40 overflow-y-auto overscroll-contain bg-bg px-5 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))] pt-6 md:hidden"
        >
          <nav aria-label="Мобільна навігація" className="flex flex-col">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={pathname === item.href || pathname.startsWith(`${item.href}/`) ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="border-b border-line py-5 text-3xl font-semibold tracking-tight"
              >
                {item.label}
              </Link>
            ))}
            <Link href="/login" onClick={() => setOpen(false)} className="border-b border-line py-5 text-3xl font-semibold tracking-tight text-accent-soft">
              Кабінет клієнта
            </Link>
          </nav>
          <Link href={orderHref} onClick={() => setOpen(false)} className={buttonStyles("primary", "mt-8 w-full")}>
            Обговорити проєкт
          </Link>
        </div>
      ) : null}
    </header>
  );
}

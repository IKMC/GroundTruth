import { useEffect, useState, type AnchorHTMLAttributes, type ReactNode } from "react"

/** Tiny hash router: three pages don't need a routing library. */
export type Path = "/" | "/volunteer" | "/about"

const read = (): Path => {
  const h = window.location.hash.replace(/^#/, "") || "/"
  return h === "/volunteer" || h === "/about" ? h : "/"
}

export function usePath(): Path {
  const [path, setPath] = useState<Path>(read)
  useEffect(() => {
    const on = () => {
      setPath(read())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener("hashchange", on)
    return () => window.removeEventListener("hashchange", on)
  }, [])
  return path
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  to: Path
  activeOptions?: { exact?: boolean }
  children: ReactNode
}

export function Link({ to, activeOptions: _a, children, ...rest }: LinkProps) {
  const path = usePath()
  return (
    <a href={`#${to}`} data-status={path === to ? "active" : undefined} aria-current={path === to ? "page" : undefined} {...rest}>
      {children}
    </a>
  )
}

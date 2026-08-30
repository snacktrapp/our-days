"use client";

import styles from "./global-error.module.css";

export default function GlobalError({
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  return (
    <html lang="en">
      <head>
        <title>Our Days — Something went wrong</title>
      </head>
      <body className={styles.body}>
        <main className={styles.card} aria-labelledby="global-error-title">
          <span className={styles.mark} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p>Something interrupted the story</p>
          <h1 id="global-error-title">We couldn’t open Our Days.</h1>
          <button className={styles.retryButton} onClick={reset}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

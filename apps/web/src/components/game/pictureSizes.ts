/**
 * How wide a question's picture shows, for the browser to pick a size by (the preload in main.tsx picks with the same,
 * so the file fetched during the reveal before is the one used). A module of its own: main.tsx needs only this.
 */
export const PICTURE_SIZES = '(min-width: 768px) 720px, 100vw';

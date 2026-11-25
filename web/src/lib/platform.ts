// What kind of device the game is on, where that changes what it says or does.

/** Whether this is an iPhone or iPad: an iPad's Safari says it's a Mac, and only its touch screen tells it apart. */
export const appleTouch = (ua = navigator.userAgent, touchPoints = navigator.maxTouchPoints): boolean =>
  /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);

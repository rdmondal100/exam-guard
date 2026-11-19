/**
 * Which app is being built (M52): `electron-vite --mode teacher|student` defines it for main,
 * preload and renderer. Branch on it with a constant comparison so the bundler drops the other
 * app's code.
 */
declare const __EG_APP__: 'teacher' | 'student';

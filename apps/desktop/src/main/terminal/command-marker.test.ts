import { describe, expect, it } from 'vitest';
import { CommandMarkerParser } from './command-marker.js';

const marker = (line: string, nonce = 'abc') =>
  `\x1b]6973;${nonce};${Buffer.from(line, 'utf8').toString('base64')}\x07`;

describe('CommandMarkerParser', () => {
  it('passes plain output through', () => {
    const p = new CommandMarkerParser('abc');
    expect(p.push('PS C:\\ws> dir\r\n')).toEqual({ text: 'PS C:\\ws> dir\r\n', commands: [] });
  });

  it('removes markers and returns their lines, UTF-8 included', () => {
    const p = new CommandMarkerParser('abc');
    const out = p.push(`a${marker('npm i lodash')}b${marker('echo "héllo"')}c`);
    expect(out).toEqual({ text: 'abc', commands: ['npm i lodash', 'echo "héllo"'] });
  });

  it('joins a marker split across chunks, at any point', () => {
    const whole = `x${marker('pacman -S freeglut')}y`;
    for (let cut = 1; cut < whole.length; cut += 1) {
      const p = new CommandMarkerParser('abc');
      const first = p.push(whole.slice(0, cut));
      const second = p.push(whole.slice(cut));
      expect(first.text + second.text).toBe('xy');
      expect([...first.commands, ...second.commands]).toEqual(['pacman -S freeglut']);
    }
  });

  it('lets a marker with another nonce or a bad body through as text', () => {
    const p = new CommandMarkerParser('abc');
    const forged = marker('rm x', 'zzz');
    const bad = '\x1b]6973;abc;not base64!\x07';
    expect(p.push(forged + bad)).toEqual({ text: forged + bad, commands: [] });
  });

  it('does not hold back other escape sequences', () => {
    const p = new CommandMarkerParser('abc');
    expect(p.push('\x1b]0;title\x07\x1b[32mok').text).toBe('\x1b]0;title\x07\x1b[32mok');
  });

  it('gives back an unfinished marker on flush', () => {
    const p = new CommandMarkerParser('abc');
    expect(p.push('a\x1b]6973;abc;ZGly').text).toBe('a');
    expect(p.flush()).toBe('\x1b]6973;abc;ZGly');
  });
});

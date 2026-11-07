import { describe, expect, it } from 'vitest';
import { nameParts, ownWords, pairPrefixes, singlePrefixes } from '../src/words.js';

describe('vocabulary', () => {
  it('splits entry-point names into words', () => {
    expect(nameParts('castVote')).toEqual(expect.arrayContaining(['castVote', 'cast', 'vote', 'castvote', 'cast_vote']));
    expect(nameParts('register_member')).toEqual(expect.arrayContaining(['register', 'member']));
  });

  it('keeps only words the common list lacks as a contract\'s own', () => {
    expect(ownWords(['castVote', 'register'])).toEqual(['cast', 'castVote', 'cast_vote', 'castvote', 'register']);
  });

  it('builds single and two-word separators', () => {
    expect(singlePrefixes(['vote'])).toEqual(['vote', 'vote:']);
    const p = pairPrefixes(['a', 'b']);
    expect(p).toEqual(expect.arrayContaining(['a:b', 'b:a', 'a_b', 'a-b', 'a/b', 'a.b', 'ab', 'a:b:']));
    expect(p).not.toContain('a:a');
  });

  it('with extra words, builds only the pairs that use one', () => {
    const p = pairPrefixes(['a', 'b'], ['x']);
    expect(p).toEqual(expect.arrayContaining(['x:a', 'a:x', 'x:b', 'b:x']));
    expect(p).not.toContain('a:b');
  });
});

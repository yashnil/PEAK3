"""FIND THE PRIME: given a player and a peak length, choose the strongest
contiguous stretch of their career.

The rules as a pure package, the same split `nba_peak/prime_cut/` uses: `pool`
decides which (player, duration) prompts are worth asking, `board` deals nine of
them, `scoring` turns a chosen window into round points, `state` enforces, and
`bot` chooses from what a seat may see. `app/services/find_the_prime/mode.py` is
the translation layer onto the Arena foundation.
"""

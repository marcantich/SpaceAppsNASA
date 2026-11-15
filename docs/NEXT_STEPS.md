# Next steps

> **Next step: use Mars' Earth twins to learn when a rover's "no traces of past life found" really
> means something, and when it only means our instruments can't see well enough.**

## 1. Calibrating the silence of Mars

### The idea in 20 seconds

If you search for dinosaur footprints with a magnifying glass that is too weak, you can walk right
over them. On Mars it is the same: if a rover finds no traces of ancient life, maybe there never was
any… or maybe its magnifying glass is not good enough. We find rocks on Earth just like those on Mars,
where we know ancient life left traces, and check whether Mars instruments would see them. That tells
us where "we found nothing" actually means something, and where it does not.

### Why it matters

- Perseverance looks for traces of **past** life (biosignatures) in rocks about 3.5 billion years old:
  degraded organic matter, fossil lipids, microbial textures, minerals formed by microbes.
- A negative result is only informative if the instruments would have seen those traces had they
  been there. Today nobody knows how sensitive the rovers are to each type of terrain.
- The problem is real: at Red Stone, a fossil river delta in the Atacama Desert with a geology similar
  to Jezero's, instruments like those sent to Mars could not detect traces of life that are known to
  be there ([Azua-Bustos et al. 2023, *Nature Communications*](https://www.nature.com/articles/s41467-023-36176-x)).
  But that was one site, chosen by hand. We would turn it into a systematic method, planet-wide.

### Why one test site is not enough

> **One test site tells you about one rock. We want to know, for every place on Mars, how blind our
> instruments would be.**

- Red Stone tells us that in **that** fossil delta, Mars-like instruments missed traces that are there.
  It does not tell us what would happen in a lake clay, a sulfate deposit, carbonates like Jezero's or
  volcanic ground: each kind of rock preserves traces differently, and instruments see each one
  differently. It is like testing a fire alarm in a single room of a building.
- **From one point to a curve.** With many test sites of different kinds we get "on this kind of
  terrain, the instruments see X %". One site gives no curve.
- **Knowing which test applies where on Mars.** This is the part the app already does: it says which
  places on Earth resemble each point of Mars. Without it, even ten test sites would not tell us which
  one to use for Jezero and which for Gale.
- **Choosing where to go.** Perseverance is in one crater, but the landing sites of the next missions
  and the samples to bring back to Earth are being decided now. The map would show where "we found
  nothing" would be worth it, and where it would be time lost.
- Other field tests with prototype instruments exist besides Red Stone (Atacama, Australian
  stromatolites…), but they are scattered, each done differently, and nobody has put them together or
  linked them to specific places on Mars. Step 2 below does exactly that.

### How we would do it

It reuses what the app already does: for any point of Mars, it finds the most similar places on Earth.

1. **Find the Earth twins of a Mars cell.** *Already works* (the analog index of this app). To be
   useful here it needs **mineralogy**, which is what preserves biosignatures (clays, carbonates,
   sulfates):
   - Mars: global maps of hydrated minerals from OMEGA and CRISM.
   - Earth: NASA **EMIT** (imaging spectrometer on the ISS, ~60 m, covers the arid regions). Its
     mineral product lets us look at Earth "with Mars eyes".
2. **Build a calibration catalogue.** A table of Earth sites where traces of ancient life were
   searched for with Mars-like instruments: site, coordinates, age of the rock, instrument type
   (Raman like SHERLOC, X-ray fluorescence like PIXL, gas chromatography–mass spectrometry like SAM),
   **detected yes / no**, and the reference. Only published results, nothing invented. Candidates:
   Red Stone and Yungay (Atacama), Pilbara stromatolites (Australia), Río Tinto (Spain).
3. **Measure the sensitivity of each Mars cell.** For a clicked Mars cell, the index already scores
   every Earth cell. Weight each calibration site by how similar it is to that Mars cell; the
   sensitivity **s** is the weighted fraction of sites where the traces were detected, per instrument,
   shown with its uncertainty (few sites → wide interval).
4. **Turn it into the value of a null result.** With Bayes' rule, a negative result changes our belief
   by a factor **1 / (1 − s)**. The app would show it on the Mars card ("value of a null result: weak /
   medium / strong"), draw the calibration sites on the Earth globe (detected / not detected, with
   their reference), and later paint a global **"blindness map" of Mars**.

### What it would tell us

| Sensitivity s | A rover finds nothing… | Meaning |
|---|---|---|
| ≈ 0 | …and our belief does not change | Silence says nothing: we would be blind even if traces were there |
| ≈ 0.5 | …and the odds of past life halve | Some information |
| ≈ 0.9 | …and the odds drop tenfold | Silence is real information |

We would map the **information value of a null result**, not "the probability of life on Mars":
that would need a prior that nobody knows. The map answers questions that matter for planning:
where to send the next rovers, which samples to bring back to Earth first, and how sensitive the
next generation of instruments must be.

### Honest limits

- Earth rocks have not spent billions of years under radiation and oxidants, so traces on Mars are
  more degraded: **s measured on Earth is an upper bound**, and on Mars we would be even more blind.
- Few calibration sites exist, so the uncertainty will be large at first.
- Mineralogy is not yet part of the index; without it, twins are similar in climate and terrain,
  not necessarily in the rocks that preserve life.

## 2. More parameters: radiation at the surface of each body

The index compares terrain, temperature, water and ice, dust and sunlight. A natural next step is to
add the **radiation that reaches the surface**, for two reasons: it limits which tests make sense on
Earth (people, electronics, materials), and it destroys organic matter, so it also feeds step 1
(how degraded the traces of past life would be).

- **Solar energy at the surface:** already computed for Mars (`solar_kwh_m2_sol`, Appelbaum & Flood
  model with the dust of each cell, `src/analogs/mars_climate.py`). Compute it the same way for the
  Moon (no atmosphere: geometry and illumination maps of the poles) and for Earth (e.g. NASA POWER),
  so it can be compared and used in the "Solar power" test.
- **Ultraviolet at the surface:** Mars and the Moon receive the short-wave UV that Earth's ozone
  blocks. Earth UV climatologies exist (e.g. NASA OMI / TROPOMI); for Mars, radiative-transfer models
  with dust. This is mostly something Earth **cannot** reproduce, so it would go in the "not analog"
  block of the card.
- **Ionising radiation (cosmic rays and solar particles):** measured on the surface of Mars by
  Curiosity's RAD and around the Moon by LRO's CRaTER, and modelled with altitude and atmospheric
  shielding (lower in Hellas, higher on Olympus Mons). Same role: an honest "Earth cannot test this"
  value, and an input for the degradation of biosignatures.

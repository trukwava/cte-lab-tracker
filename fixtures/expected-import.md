# Expected sample import review

`import-sample.csv` yields four rows: first accepted; second invalid (tag already exists); third invalid (home location missing); fourth valid with a nonblocking warning that the serial reference is already shared. In the same batch, correct rejected rows and accept: previously accepted row does not duplicate. The separate `import-corrected.csv` file is illustrative; if you start it as a *new* batch after the first valid rows were committed, the repeated tags will be correctly reported as duplicates. Import uses original/normalized per-row provenance records.

# Retained merchant fixture dependencies

Whole-unit run 84064 had missing pinned native geometry/rendering files, plus
two actual retained-adapter gaps. Gathering priority's empty merchant bag was
represented by an empty array rather than forty-two empty native slots, so the
new capacity guard correctly refused it. The interrupted batch adapter lacked
the private protection checkpoint, runtime ownership and stock-reservation
dependencies now consulted before inventory adoption.

Restore pinned fixtures separately. Update these existing adapters to declare
native inventory capacity and an owned job with an empty external reservation
response, while executing the maintained stock filter. Preserve the existing
strict prohibition against stealing the other purchased batch inputs and all
priority/home-realm assertions. Add no isolated test cases or production changes.

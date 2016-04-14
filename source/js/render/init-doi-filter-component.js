/**
 * Compute doi weight based on nodes initially set as filtered.
 * @param lNodes Layer nodes.
 */
function initDoiFilterComponent (lNodes) {
  lNodes.values().forEach(ln => {
    ln.filtered = true;
    ln.doi.filteredChanged();

    ln.children.values().forEach(an => {
      an.filtered = true;
      an.doi.filteredChanged();

      an.children.values().forEach(san => {
        san.filtered = true;
        san.doi.filteredChanged();

        san.children.values().forEach(n => {
          n.filtered = true;
          n.doi.filteredChanged();
        });
      });
    });
  });
}

export default initDoiFilterComponent;

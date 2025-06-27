function calculateFeeRatios(duration) {
  const ratios = [];
  for (let i = 0; i < duration; i++) {
    const turnNumber = i + 1;
    if (turnNumber <= 4) {
      ratios.push(0.07);
    } else if (turnNumber <= 9) {
      ratios.push(0.05);
    } else if (turnNumber === 10) {
      ratios.push(-0.02);
    } else {
      ratios.push(0.0);
    }
  }
  return ratios;
}

module.exports = {
  calculateFeeRatios,
};

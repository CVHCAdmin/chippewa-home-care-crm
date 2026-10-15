// tests/geocode.test.js — client address → map coordinates
process.env.DATABASE_URL = 'postgresql://fake:fake@localhost/fake';
jest.mock('../src/db', () => ({ query: jest.fn(), pool: { on: jest.fn() } }));
const { stripUnit, distanceFeet } = require('../src/helpers/geocode');

test('apartment / unit numbers are dropped for the lookup (same building)', () => {
  expect(stripUnit('509 N High St APT 208, Chippewa Falls, WI, 54729')).toBe('509 N High St, Chippewa Falls, WI, 54729');
  expect(stripUnit('1105 S Barstow St #224, Eau Claire, WI')).toBe('1105 S Barstow St, Eau Claire, WI');
  expect(stripUnit('3304 14th St Apt 105, Eau Claire')).toBe('3304 14th St, Eau Claire');
  expect(stripUnit('12 Main St, Unit B-2, Altoona')).toBe('12 Main St, Altoona');
});

test('street names that merely start like a unit word are left alone', () => {
  expect(stripUnit('45 Lotus Ave, Eau Claire')).toBe('45 Lotus Ave, Eau Claire');
  expect(stripUnit('7 Unity Rd, Altoona')).toBe('7 Unity Rd, Altoona');
  expect(stripUnit('N52761 County Road Y, Eleva')).toBe('N52761 County Road Y, Eleva');
});

test('distance in feet', () => {
  expect(distanceFeet(44.8048, -91.49364, 44.8048, -91.49364)).toBe(0);
  const d = distanceFeet(44.8048, -91.49364, 44.8058, -91.49364); // 0.001° latitude ≈ 364 ft
  expect(d).toBeGreaterThan(350); expect(d).toBeLessThan(380);
});

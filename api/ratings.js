import ratings from '../server/ratings.cjs';

// Server access uses keyless credentials; the environment flag controls availability.
export default ratings.createHandler();

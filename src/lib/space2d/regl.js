export default function createREGL(opts){
  const f = (typeof window !== 'undefined' && (window.createREGL || window.regl));
  if (!f) throw new Error('createREGL not found on window');
  return f(opts);
}

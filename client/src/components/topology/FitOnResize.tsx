import { useReactFlow } from '@xyflow/react';
import { useEffect } from 'react';

/** Re-fit a React Flow view when the window is resized (React Flow only fits once on mount). Render inside <ReactFlow>. */
export function FitOnResize({ padding }: { padding: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    let raf = 0;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => void fitView({ padding }));
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [fitView, padding]);
  return null;
}

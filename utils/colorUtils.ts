
import { BOUNDING_BOX_COLORS } from '../constants';

const labelColorMap = new Map<string, string>();
let colorIndex = 0;

export const getLabelColor = (label: string): string => {
  if (!labelColorMap.has(label)) {
    labelColorMap.set(label, BOUNDING_BOX_COLORS[colorIndex % BOUNDING_BOX_COLORS.length]);
    colorIndex++;
  }
  return labelColorMap.get(label) as string;
};

export const resetLabelColors = (): void => {
  labelColorMap.clear();
  colorIndex = 0;
};
    
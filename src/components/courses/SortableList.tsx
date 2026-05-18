import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Box, ActionIcon } from "@mantine/core";
import { IconGripVertical } from "@tabler/icons-react";
import type { ReactNode } from "react";

interface SortableItem {
  id: string;
}

interface SortableListProps<T extends SortableItem> {
  items: T[];
  onReorder: (next: T[]) => void;
  renderItem: (item: T, dragHandle: ReactNode) => ReactNode;
}

function SortableRow<T extends SortableItem>({
  item,
  renderItem,
}: {
  item: T;
  renderItem: SortableListProps<T>["renderItem"];
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const handle = (
    <ActionIcon variant="subtle" color="gray" {...attributes} {...listeners} style={{ cursor: "grab" }}>
      <IconGripVertical size={16} />
    </ActionIcon>
  );
  return (
    <Box ref={setNodeRef} style={style}>
      {renderItem(item, handle)}
    </Box>
  );
}

export function SortableList<T extends SortableItem>({ items, onReorder, renderItem }: SortableListProps<T>) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = items.findIndex((i) => i.id === active.id);
    const newIdx = items.findIndex((i) => i.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    onReorder(arrayMove(items, oldIdx, newIdx));
  };
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
        {items.map((item) => (
          <SortableRow key={item.id} item={item} renderItem={renderItem} />
        ))}
      </SortableContext>
    </DndContext>
  );
}

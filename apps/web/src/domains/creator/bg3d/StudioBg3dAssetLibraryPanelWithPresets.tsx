import { useRef, useState, type ComponentProps } from "react";

import { StudioBg3dAssetLibraryPanel as ExistingAssetLibraryPanel } from "./StudioBg3dAssetLibraryPanel";
import { StudioReferenceRebuildPresets } from "./StudioReferenceRebuildPresets";

type Props = ComponentProps<typeof ExistingAssetLibraryPanel>;

/** Compose the optional generator without relocating the canonical file-input and rights panel. */
export function StudioBg3dAssetLibraryPanelWithPresets(props: Props) {
  const scopeRef = useRef<HTMLDivElement>(null);
  const [isBuilding, setIsBuilding] = useState(false);

  const handOffFile = (file: File): void => {
    const input = scopeRef.current?.querySelector<HTMLInputElement>('input[type="file"]');
    const importButton = input?.nextElementSibling;
    if (!input || props.isUploading || props.isRestoringScene || props.deletingModelId !== null
      || !(importButton instanceof HTMLButtonElement) || importButton.disabled) {
      throw new Error("현재 가져오기를 시작할 수 없습니다. 진행 중인 작업과 이용 권리 입력을 확인해 주세요.");
    }
    if (typeof DataTransfer !== "function") {
      throw new Error("이 브라우저는 직접 전달을 지원하지 않습니다. 검토실에서 GLB를 저장한 뒤 가져와 주세요.");
    }
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  };

  return (
    <div ref={scopeRef}>
      <fieldset disabled={isBuilding} className="m-0 min-w-0 border-0 p-0">
        <ExistingAssetLibraryPanel {...props} />
      </fieldset>
      <StudioReferenceRebuildPresets
        disabled={props.isUploading || props.isRestoringScene || props.deletingModelId !== null}
        onFile={handOffFile}
        onBusyChange={setIsBuilding}
      />
    </div>
  );
}

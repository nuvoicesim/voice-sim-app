import { useEffect, useState, useRef } from "react";
import { Autocomplete, type AutocompleteProps } from "@mantine/core";
import { cognitoUserApi } from "../../api/cognitoUserApi";

interface Props extends Omit<AutocompleteProps, "data"> {
  roleFilter?: "student" | "faculty" | "admin";
}

export function EmailTypeaheadInput({ roleFilter, value, onChange, ...rest }: Props) {
  const [data, setData] = useState<string[]>([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!value || value.length < 2) {
      setData([]);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const params: Record<string, string> = { list: "true", search: value, limit: "10" };
        if (roleFilter) params.role = roleFilter;
        const res: any = await (cognitoUserApi as any).list?.(params).catch(() => null);
        const list: any[] = res?.users || [];
        const emails = list
          .map((u) => u.attributes?.email || u.username || "")
          .filter(Boolean);
        setData(Array.from(new Set(emails)));
      } catch {
        setData([]);
      }
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, roleFilter]);

  return <Autocomplete {...rest} value={value} onChange={onChange} data={data} />;
}

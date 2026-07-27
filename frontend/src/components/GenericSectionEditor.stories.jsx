import { useState } from "react";
import GenericSectionEditor from "@/components/GenericSectionEditor";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";

const goalsPack = packs.find((p) => p.key === "goals");

// Stateful wrapper: the component is controlled, so a static `data` prop would
// make every control appear frozen when someone tries the story by hand.
function Stateful({ pack, initial }) {
  const [data, setData] = useState(initial);
  return <GenericSectionEditor pack={pack} data={data} onChange={setData} />;
}

export default {
  title: "Sections/GenericSectionEditor",
  component: GenericSectionEditor,
};

export const Populated = {
  render: () => <Stateful pack={goalsPack} initial={goalsData} />,
};

export const Empty = {
  render: () => <Stateful pack={goalsPack} initial={{ goals: [] }} />,
};

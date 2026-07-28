import { useState } from "react";
import SectionRenderer from "@/renderers/SectionRenderer";
import packs from "@/__fixtures__/packs.json";
import goalsData from "@/__fixtures__/data/goals.json";

const goalsPack = packs.find((p) => p.key === "goals");

// Stateful wrapper: the component is controlled, so a static `data` prop would
// make every control appear frozen when someone tries the story by hand.
function Stateful({ pack, initial }) {
  const [data, setData] = useState(initial);
  return <SectionRenderer pack={pack} data={data} onChange={setData} />;
}

export default {
  title: "Sections/SectionRenderer",
  component: SectionRenderer,
};

export const Populated = {
  render: () => <Stateful pack={goalsPack} initial={goalsData} />,
};

export const Empty = {
  render: () => <Stateful pack={goalsPack} initial={{ goals: [] }} />,
};

// <playing-card> for React, with the `card` prop typed as the cards the games actually deal.
//
// Zubra types a component's props from their default values, so `card` comes out as the default's
// shape ({ kind, suit, rank }) and a joker or a Fruit Salad card doesn't fit. There's no way yet to
// say otherwise in the component (https://github.com/journey-to-code-org/zubra/issues/270), so the
// card room's React code imports the component from here.
import type { KCard } from "@cardroom/games";
import Raw from "@spades/ui/playing-card.zb";
import type { Card } from "@spades/rules";
import type { ComponentProps, ComponentType } from "react";

type Props = Omit<ComponentProps<typeof Raw>, "card"> & { card?: Card | KCard };

export default Raw as unknown as ComponentType<Props>;

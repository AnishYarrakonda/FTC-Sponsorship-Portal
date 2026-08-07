'use client'

import * as React from 'react'
import { Check, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'

const states = [
  { abbreviation: "AL", name: "Alabama" },
  { abbreviation: "AK", name: "Alaska" },
  { abbreviation: "AZ", name: "Arizona" },
  { abbreviation: "AR", name: "Arkansas" },
  { abbreviation: "CA", name: "California" },
  { abbreviation: "CO", name: "Colorado" },
  { abbreviation: "CT", name: "Connecticut" },
  { abbreviation: "DE", name: "Delaware" },
  { abbreviation: "FL", name: "Florida" },
  { abbreviation: "GA", name: "Georgia" },
  { abbreviation: "HI", name: "Hawaii" },
  { abbreviation: "ID", name: "Idaho" },
  { abbreviation: "IL", name: "Illinois" },
  { abbreviation: "IN", name: "Indiana" },
  { abbreviation: "IA", name: "Iowa" },
  { abbreviation: "KS", name: "Kansas" },
  { abbreviation: "KY", name: "Kentucky" },
  { abbreviation: "LA", name: "Louisiana" },
  { abbreviation: "ME", name: "Maine" },
  { abbreviation: "MD", name: "Maryland" },
  { abbreviation: "MA", name: "Massachusetts" },
  { abbreviation: "MI", name: "Michigan" },
  { abbreviation: "MN", name: "Minnesota" },
  { abbreviation: "MS", name: "Mississippi" },
  { abbreviation: "MO", name: "Missouri" },
  { abbreviation: "MT", name: "Montana" },
  { abbreviation: "NE", "name": "Nebraska" },
  { abbreviation: "NV", "name": "Nevada" },
  { abbreviation: "NH", "name": "New Hampshire" },
  { abbreviation: "NJ", "name": "New Jersey" },
  { abbreviation: "NM", "name": "New Mexico" },
  { abbreviation: "NY", "name": "New York" },
  { abbreviation: "NC", "name": "North Carolina" },
  { abbreviation: "ND", "name": "North Dakota" },
  { abbreviation: "OH", "name": "Ohio" },
  { abbreviation: "OK", "name": "Oklahoma" },
  { abbreviation: "OR", "name": "Oregon" },
  { abbreviation: "PA", "name": "Pennsylvania" },
  { abbreviation: "RI", "name": "Rhode Island" },
  { abbreviation: "SC", "name": "South Carolina" },
  { abbreviation: "SD", "name": "South Dakota" },
  { abbreviation: "TN", "name": "Tennessee" },
  { abbreviation: "TX", "name": "Texas" },
  { abbreviation: "UT", "name": "Utah" },
  { abbreviation: "VT", "name": "Vermont" },
  { abbreviation: "VA", "name": "Virginia" },
  { abbreviation: "WA", "name": "Washington" },
  { abbreviation: "WV", "name": "West Virginia" },
  { abbreviation: "WI", "name": "Wisconsin" },
  { abbreviation: "WY", "name": "Wyoming" }
]

interface StateSelectorProps {
  value?: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

export function StateSelector({ value, onChange, placeholder = "Select state...", className }: StateSelectorProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button type="button"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              "bg-background border-input text-foreground hover:bg-accent cursor-pointer transition-colors",
              className
            )}
          />
        }
      >
        <span className="truncate">
          {value
            ? states.find((state) => state.abbreviation === value || state.name === value)?.name
            : placeholder}
        </span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </PopoverTrigger>

      <PopoverContent className="w-full p-0 bg-popover border-border">
        <Command className="bg-popover text-popover-foreground">
          <CommandInput placeholder="Search state..." className="h-9 border-none focus:ring-0" />
          <CommandList>
            <CommandEmpty>No state found.</CommandEmpty>
            <CommandGroup>
              {states.map((state) => (
                <CommandItem
                  key={state.abbreviation}
                  value={state.name}
                  onSelect={() => {
                    onChange(state.abbreviation)
                    setOpen(false)
                  }}
                  className="hover:bg-accent cursor-pointer"
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === state.abbreviation || value === state.name ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {state.name} ({state.abbreviation})
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

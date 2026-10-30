Feature: Outline parameter highlighting
  Scenario Outline: Highlight placeholders and values
    Given parameter e2e <name> has 42 items

    Examples:
      | name   |
      | widget |
